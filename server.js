const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.existsSync(path.join(__dirname, 'public')) || fs.mkdirSync(path.join(__dirname, 'public'));
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://aymnfayz:AyAy3344@nexus-chat.c0o7sje.mongodb.net/nexus-chat?retryWrites=true&w=majority';
mongoose.connect(MONGO_URI)
  .then(() => console.log('تم الاتصال بقاعدة البيانات بنجاح'))
  .catch(err => console.log('خطأ في الاتصال بقاعدة البيانات:', err));

// بوابات المصادقة
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: 'تم إنشاء الحساب بنجاح!' });
  } catch (err) {
    console.error('خطأ في التسجيل:', err);
    res.status(500).json({ error: 'حدث خطأ، البريد مستخدم مسبقاً.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'الرجاء إدخال البريد وكلمة المرور' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'البريد غير مسجل.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'كلمة المرور غير صحيحة.' });
    }

    res.json({ 
      message: 'تم تسجيل الدخول بنجاح', 
      user: { 
        id: user._id.toString(), 
        username: user.username, 
        email: user.email, 
        avatar: user.avatar || '', 
        banner: user.banner || '' 
      } 
    });
  } catch (err) {
    console.error('خطأ مفصل في تسجيل الدخول:', err);
    res.status(500).json({ error: 'خطأ في الخادم: ' + err.message });
  }
});

app.post('/api/profile/update', async (req, res) => {
  try {
    const { userId, username, avatar, banner } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { username, avatar, banner },
      { new: true }
    ).select('-password');

    res.json({ 
      message: 'تم تحديث الملف الشخصي', 
      user: { 
        id: updatedUser._id.toString(), 
        username: updatedUser.username, 
        email: updatedUser.email, 
        avatar: updatedUser.avatar, 
        banner: updatedUser.banner 
      } 
    });
  } catch (err) {
    console.error('خطأ في التحديث:', err);
    res.status(500).json({ message: 'خطأ أثناء التحديث' });
  }
});

// بوابات نظام الأصدقاء
app.get('/api/users/search', async (req, res) => {
  try {
    const { query, currentUserId } = req.query;
    const filter = {};
    if (currentUserId && mongoose.Types.ObjectId.isValid(currentUserId)) {
      filter._id = { $ne: currentUserId };
    }
    if (query && query.trim() !== '') {
      filter.username = { $regex: query, $options: 'i' };
    }
    const users = await User.find(filter).select('_id username avatar friends friendRequests');
    res.json(users);
  } catch (err) {
    console.error('خطأ في البحث:', err);
    res.status(500).json({ message: 'خطأ في البحث' });
  }
});

app.post('/api/friends/request', async (req, res) => {
  try {
    const { fromUserId, toUserId } = req.body;
    if (!fromUserId || !toUserId) return res.status(400).json({ message: 'بيانات غير كافية' });

    const targetUser = await User.findById(toUserId);
    if (!targetUser) return res.status(404).json({ message: 'المستخدم غير موجود' });

    if (!targetUser.friends) targetUser.friends = [];
    if (!targetUser.friendRequests) targetUser.friendRequests = [];

    if (targetUser.friends.some(id => id.toString() === fromUserId)) {
      return res.status(400).json({ message: 'أنتما أصدقاء بالفعل!' });
    }
    if (targetUser.friendRequests.some(id => id.toString() === fromUserId)) {
      return res.status(400).json({ message: 'تم إرسال الطلب مسبقاً.' });
    }

    targetUser.friendRequests.push(fromUserId);
    await targetUser.save();

    io.to(toUserId).emit('new_friend_request', { toUserId, fromUserId });
    res.json({ message: 'تم إرسال طلب الصداقة بنجاح!' });
  } catch (err) {
    console.error('خطأ في طلب الصداقة:', err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

app.post('/api/friends/respond', async (req, res) => {
  try {
    const { userId, requesterId, action } = req.body;
    const currentUser = await User.findById(userId);
    const requesterUser = await User.findById(requesterId);

    if (!currentUser) return res.status(404).json({ message: 'المستخدم غير موجود' });

    if (!currentUser.friendRequests) currentUser.friendRequests = [];
    if (!currentUser.friends) currentUser.friends = [];
    if (requesterUser && !requesterUser.friends) requesterUser.friends = [];

    currentUser.friendRequests = currentUser.friendRequests.filter(id => id.toString() !== requesterId);

    if (action === 'accept' && requesterUser) {
      if (!currentUser.friends.some(id => id.toString() === requesterId)) currentUser.friends.push(requesterId);
      if (!requesterUser.friends.some(id => id.toString() === userId)) requesterUser.friends.push(userId);
      await requesterUser.save();
    }

    await currentUser.save();
    io.emit('friends_updated', { user1: userId, user2: requesterId });

    res.json({ message: action === 'accept' ? 'تم قبول الصداقة!' : 'تم رفض الطلب' });
  } catch (err) {
    console.error('خطأ في الرد:', err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

app.get('/api/friends/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'معرّف المستخدم غير صالح' });
    }

    const user = await User.findById(userId)
      .populate('friends', '_id username avatar')
      .populate('friendRequests', '_id username avatar');

    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });

    res.json({
      friends: user.friends || [],
      requests: user.friendRequests || []
    });
  } catch (err) {
    console.error('خطأ جلب الأصدقاء:', err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

let activeUsers = [];
io.on('connection', (socket) => {
  socket.on('join_room', (userId) => {
    if (userId) socket.join(userId);
  });

  socket.on('send_message', (data) => {
    if (data.recipientId !== 'global') {
      socket.emit('receive_message', data);
      io.to(data.recipientId).emit('receive_message', data);
    } else {
      io.emit('receive_message', data);
    }
  });

  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`السيرفر يعمل الآن على البورت: ${PORT}`);
});
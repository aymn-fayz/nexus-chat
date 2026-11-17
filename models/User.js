const mongoose = require('mongoose');

// هذا هو قالب شكل المستخدم في قاعدة البيانات
const userSchema = new mongoose.Schema({
  username: { type: String, required: true }, // اسم المستخدم
  email: { type: String, required: true, unique: true }, // البريد الإلكتروني (يجب أن يكون فريداً وغير مكرر)
  password: { type: String, required: true } // كلمة المرور المشفرة
});

module.exports = mongoose.model('User', userSchema);
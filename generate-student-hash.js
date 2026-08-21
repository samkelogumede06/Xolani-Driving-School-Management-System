const bcrypt = require('bcrypt');

async function generateStudentHash() {
    const password = 'Student123!';
    const saltRounds = 10;
    
    console.log('🔐 Generating fresh hash for:', password);
    console.log('');
    
    const hash = await bcrypt.hash(password, saltRounds);
    console.log('📝 Password:', password);
    console.log('🔑 Hash:', hash);
    console.log('');
    console.log('📋 Run this SQL in MySQL Workbench:');
    console.log(`UPDATE profiles SET password_hash = '${hash}' WHERE email = 'teststudent@xolanidriving.co.za';`);
    console.log('');
    console.log('Then try login with:');
    console.log('Email: teststudent@xolanidriving.co.za');
    console.log('Password: Student123!');
}

generateStudentHash();
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function testStudentHash() {
    try {
        // Connect to MySQL
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'xolani_driving_school'
        });

        // Get the student
        const [rows] = await connection.query(
            'SELECT email, password_hash FROM profiles WHERE email = ?',
            ['teststudent@xolanidriving.co.za']
        );

        if (rows.length === 0) {
            console.log('❌ Student not found');
            return;
        }

        const user = rows[0];
        const password = 'Student123!';
        
        console.log('📧 Email:', user.email);
        console.log('🔑 Hash:', user.password_hash);
        console.log('');
        console.log('🔐 Testing password:', password);
        
        const isValid = await bcrypt.compare(password, user.password_hash);
        console.log('✅ Password valid?', isValid);
        
        if (isValid) {
            console.log('🎉 Password is correct! You can login now.');
        } else {
            console.log('❌ Password is incorrect.');
            console.log('');
            console.log('🔧 Let\'s generate a new hash directly...');
            
            const newHash = await bcrypt.hash(password, 10);
            console.log('📝 New hash:', newHash);
            console.log('');
            console.log('📋 Run this SQL:');
            console.log(`UPDATE profiles SET password_hash = '${newHash}' WHERE email = 'teststudent@xolanidriving.co.za';`);
        }

        await connection.end();

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testStudentHash();
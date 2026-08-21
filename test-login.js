const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function testLogin() {
    try {
        // Connect to MySQL
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'xolani_driving_school'
        });

        // Get the user
        const [rows] = await connection.query(
            'SELECT * FROM profiles WHERE email = ?',
            ['admin@xolanidriving.co.za']
        );

        if (rows.length === 0) {
            console.log('❌ User not found');
            return;
        }

        const user = rows[0];
        console.log('📧 Email:', user.email);
        console.log('🔑 Hash:', user.password_hash);
        console.log('📝 Hash length:', user.password_hash.length);
        console.log('');

        // Test the password
        const password = 'Admin123!';
        console.log('🔐 Testing password:', password);

        try {
            const isValid = await bcrypt.compare(password, user.password_hash);
            console.log('✅ Password valid?', isValid);
            
            if (isValid) {
                console.log('🎉 Password is correct! Login should work.');
            } else {
                console.log('❌ Password is incorrect.');
                console.log('');
                console.log('🔧 Let\'s try generating a new hash...');
                
                // Generate a new hash
                const saltRounds = 10;
                const newHash = await bcrypt.hash(password, saltRounds);
                console.log('📝 New hash:', newHash);
                console.log('');
                console.log('📋 Run this SQL in MySQL Workbench to fix:');
                console.log(`UPDATE profiles SET password_hash = '${newHash}' WHERE email = 'admin@xolanidriving.co.za';`);
            }
        } catch (error) {
            console.error('❌ Error comparing passwords:', error.message);
        }

        await connection.end();

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testLogin();
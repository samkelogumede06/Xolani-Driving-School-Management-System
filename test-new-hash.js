const bcrypt = require('bcrypt');

async function testNewHash() {
    const password = 'Admin123!';
    const newHash = '$2b$10$cKB9Z0hhsptBxevMofjr6eGmOlPkyC/T7TIOZZzn3JcggLyLlWkTW';
    
    console.log('🔐 Testing new hash...');
    console.log('Password:', password);
    console.log('Hash:', newHash);
    console.log('');
    
    const isValid = await bcrypt.compare(password, newHash);
    console.log('✅ Password valid?', isValid);
    
    if (isValid) {
        console.log('🎉 New hash works! You can now login.');
    } else {
        console.log('❌ Still not working. Let me generate another one.');
    }
}

testNewHash();
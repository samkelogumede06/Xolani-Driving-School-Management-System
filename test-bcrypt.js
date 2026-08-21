// Try both bcrypt and bcryptjs
try {
    const bcrypt = require('bcrypt');
    console.log('✅ Using bcrypt (native)');
    
    const storedHash = '$2b$10$N9qo8uLOickgx2ZMRZoMy.MrIyYH5IYVgU4.bIfMZ6EBY4qYTVrMK';
    const password = 'Admin123!';
    
    const isValid = await bcrypt.compare(password, storedHash);
    console.log('Password valid?', isValid);
    console.log('Password:', password);
    console.log('Hash:', storedHash);
    
    if (isValid) {
        console.log('✅ bcrypt works!');
    } else {
        console.log('❌ bcrypt failed to validate');
    }
} catch (error) {
    console.error('❌ Error with bcrypt:', error.message);
    
    // Try bcryptjs
    try {
        const bcryptjs = require('bcryptjs');
        console.log('Trying bcryptjs...');
        const storedHash = '$2b$10$N9qo8uLOickgx2ZMRZoMy.MrIyYH5IYVgU4.bIfMZ6EBY4qYTVrMK';
        const password = 'Admin123!';
        
        const isValid = await bcryptjs.compare(password, storedHash);
        console.log('Password valid?', isValid);
        
        if (isValid) {
            console.log('✅ bcryptjs works!');
            console.log('⚠️ Use bcryptjs instead of bcrypt in auth.js');
        }
    } catch (e) {
        console.error('❌ Error with bcryptjs:', e.message);
    }
}
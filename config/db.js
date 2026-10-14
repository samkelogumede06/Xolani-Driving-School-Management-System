const mysql = require('mysql2/promise');

// Hosted databases such as Aiven require an encrypted connection.
// Set DB_SSL_CA to the provider's CA certificate (the full PEM text) to enable it.
const ssl = process.env.DB_SSL_CA
    ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true }
    : undefined;

// Create connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xolani_driving_school',
    ssl,
    // Return DATE columns as 'YYYY-MM-DD' strings (the app compares and displays them as text)
    dateStrings: ['DATE'],
    // The school runs on South African time (UTC+2, no daylight saving)
    timezone: '+02:00',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Make NOW()/CURDATE() in SQL use South African time too (hosted servers run on UTC)
pool.on('connection', connection => {
    connection.query("SET time_zone = '+02:00'");
});

// Test connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Connected to MySQL database');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ MySQL connection failed:', error.message);
        return false;
    }
}

module.exports = { pool, testConnection };
// server/db.js
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
    connectionString: process.env.DB_URL,
    ssl: {
        require: true,
        rejectUnauthorized: false,
    },
});

module.exports = pool;

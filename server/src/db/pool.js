// Single shared pg connection pool.
const { Pool } = require('pg');
const { databaseUrl } = require('../config');

const pool = new Pool({ connectionString: databaseUrl });

module.exports = pool;

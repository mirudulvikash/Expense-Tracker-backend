const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// PostgreSQL Pool setup
const rawDbUrl = process.env.DATABASE_URL || '';
const cleanDbUrl = rawDbUrl.split('?')[0];

const pool = new Pool({
  connectionString: cleanDbUrl || process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// GET /api/test endpoint
app.get('/api/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users;');
    res.json(result.rows);
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error executing query:', error);
    res.status(500).json({ error: 'Failed to fetch users', details: error.message });
  }
});

// GET /api/transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transactions ORDER BY created_at DESC;');
    res.json(result.rows);
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions', details: error.message });
  }
});

// POST /api/transactions
app.post('/api/transactions', async (req, res) => {
  try {
    const { title, amount, type, category, date } = req.body;
    const queryText = `
      INSERT INTO transactions (title, amount, type, category, date, user_id)
      VALUES ($1, $2, $3, $4, $5, 1)
      RETURNING *;
    `;
    const values = [title, amount, type, category, date];
    const result = await pool.query(queryText, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction', details: error.message });
  }
});

// DELETE /api/transactions/:id
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const queryText = 'DELETE FROM transactions WHERE id = $1 RETURNING *;';
    const result = await pool.query(queryText, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ message: 'Transaction deleted successfully', deletedTransaction: result.rows[0] });
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Failed to delete transaction', details: error.message });
  }
});

// GET /api/budgets
app.get('/api/budgets', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM budgets WHERE user_id = 1;');
    res.json(result.rows);
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error fetching budgets:', error);
    res.status(500).json({ error: 'Failed to fetch budgets', details: error.message });
  }
});

// POST /api/budgets
app.post('/api/budgets', async (req, res) => {
  try {
    const { month_year, target_amount } = req.body;
    const queryText = `
      INSERT INTO budgets (user_id, month_year, target_amount)
      VALUES (1, $1, $2)
      ON CONFLICT (user_id, month_year)
      DO UPDATE SET target_amount = $2
      RETURNING *;
    `;
    const values = [month_year, target_amount];
    const result = await pool.query(queryText, values);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error saving budget:', error);
    res.status(500).json({ error: 'Failed to save budget', details: error.message });
  }
});

// GET /api/profile
app.get('/api/profile', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = 1;');
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile', details: error.message });
  }
});

// PUT /api/profile
app.put('/api/profile', async (req, res) => {
  try {
    const { name, avatar_url, base_loan } = req.body;
    const queryText = `
      UPDATE users
      SET name = $1, avatar_url = $2, base_loan = $3
      WHERE id = 1
      RETURNING *;
    `;
    const values = [name, avatar_url, base_loan];
    const result = await pool.query(queryText, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update user profile', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

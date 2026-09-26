const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'expenseflow_jwt_secret_key_2026';

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

// Auto-run schema migration for password_hash & user table columns
const initDb = async () => {
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS base_loan NUMERIC DEFAULT 0;
    `);
    console.log('Database schema verified/updated successfully.');
  } catch (error) {
    console.error('Database setup error:', error);
  }
};
initDb();

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error('JWT verification error:', err);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = decoded; // Contains req.user.id
    next();
  });
};

// GET /api/test endpoint (public)
app.get('/api/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, avatar_url, base_loan FROM users;');
    res.json(result.rows);
  } catch (error) {
    console.error('Database Error:', error);
    res.status(500).json({ error: 'Failed to fetch users', details: error.message });
  }
});

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check if user already exists
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1;', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password with bcrypt
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=EAB308&color=000&size=150`;

    // Insert user into PostgreSQL database
    const insertQuery = `
      INSERT INTO users (name, email, password_hash, avatar_url, base_loan)
      VALUES ($1, $2, $3, $4, 0)
      RETURNING id, name, email, avatar_url, base_loan;
    `;
    const result = await pool.query(insertQuery, [name, email, password_hash, defaultAvatar]);
    const user = result.rows[0];

    // Sign JWT
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, user });
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error during signup:', error);
    res.status(500).json({ error: 'Failed to register user', details: error.message });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const result = await pool.query('SELECT * FROM users WHERE email = $1;', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Verify password with bcrypt
    if (!user.password_hash) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Sign JWT
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    const userData = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url,
      base_loan: Number(user.base_loan || 0)
    };

    res.json({ token, user: userData });
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Failed to log in', details: error.message });
  }
});

// GET /api/transactions (Protected)
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC;', [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions', details: error.message });
  }
});

// POST /api/transactions (Protected)
app.post('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { title, amount, type, category, date } = req.body;
    const queryText = `
      INSERT INTO transactions (title, amount, type, category, date, user_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const values = [title, amount, type, category, date, req.user.id];
    const result = await pool.query(queryText, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction', details: error.message });
  }
});

// DELETE /api/transactions/:id (Protected)
app.delete('/api/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const queryText = 'DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING *;';
    const result = await pool.query(queryText, [id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found or unauthorized' });
    }

    res.json({ message: 'Transaction deleted successfully', deletedTransaction: result.rows[0] });
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Failed to delete transaction', details: error.message });
  }
});

// GET /api/budgets (Protected)
app.get('/api/budgets', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM budgets WHERE user_id = $1;', [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error fetching budgets:', error);
    res.status(500).json({ error: 'Failed to fetch budgets', details: error.message });
  }
});

// POST /api/budgets (Protected)
app.post('/api/budgets', authenticateToken, async (req, res) => {
  try {
    const { month_year, target_amount } = req.body;
    const queryText = `
      INSERT INTO budgets (user_id, month_year, target_amount)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, month_year)
      DO UPDATE SET target_amount = $3
      RETURNING *;
    `;
    const values = [req.user.id, month_year, target_amount];
    const result = await pool.query(queryText, values);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error saving budget:', error);
    res.status(500).json({ error: 'Failed to save budget', details: error.message });
  }
});

// GET /api/profile (Protected)
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, avatar_url, base_loan FROM users WHERE id = $1;', [req.user.id]);
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

// PUT /api/profile (Protected)
app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { name, avatar_url, base_loan } = req.body;
    const queryText = `
      UPDATE users
      SET name = $1, avatar_url = $2, base_loan = $3
      WHERE id = $4
      RETURNING id, name, email, avatar_url, base_loan;
    `;
    const values = [name, avatar_url, base_loan, req.user.id];
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

// DELETE /api/profile (Protected)
app.delete('/api/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    await pool.query('DELETE FROM transactions WHERE user_id = $1;', [userId]);
    await pool.query('DELETE FROM budgets WHERE user_id = $1;', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1;', [userId]);
    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Database Error:', error);
    console.error('Error deleting user profile:', error);
    res.status(500).json({ error: 'Failed to delete user account', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

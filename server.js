const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ==================== ROUTES ====================

// 1. Home Route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Seva Kendra API Working! 🚀',
    version: '1.0.0',
    endpoints: {
      home: 'GET /',
      health: 'GET /health',
      services: 'GET /api/services',
      users: 'GET /api/users',
      register: 'POST /api/users/register',
      applications: 'GET /api/applications',
      create_application: 'POST /api/applications',
      login: 'POST /api/auth/login'
    }
  });
});

// 2. Health Check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'OK', 
      database: 'Connected ✅',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      database: 'Disconnected ❌',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 3. Services API
app.get('/api/services', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM services WHERE is_active = true ORDER BY name');
    res.json({
      success: true,
      data: result.rows,
      count: result.rowCount
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// 4. Users API
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, phone, role, is_active, created_at FROM users ORDER BY created_at DESC');
    res.json({
      success: true,
      data: result.rows,
      count: result.rowCount
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// 5. User Registration - WITHOUT PASSWORD HASHING
app.post('/api/users/register', async (req, res) => {
  try {
    const { name, phone, password, role } = req.body;
    
    console.log('📝 Registration attempt:', { name, phone, password });
    
    if (!name || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone and password are required'
      });
    }

    // Check if phone already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE phone = $1',
      [phone]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already registered'
      });
    }

    // Insert new user (without password hashing)
    const result = await pool.query(
      'INSERT INTO users (name, phone, password, role, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, phone, role, is_active, created_at',
      [name, phone, password, role || 'user', true]
    );
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: result.rows[0].id, phone: phone },
      process.env.JWT_SECRET || 'seva-kendra-secret-key-2024',
      { expiresIn: '24h' }
    );
    
    console.log('✅ User registered successfully:', result.rows[0].name);
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token: token,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// 6. Applications API
app.get('/api/applications', async (req, res) => {
  try {
    const { phone } = req.query;
    
    let query = `
      SELECT a.*, s.name as service_name, s.fee 
      FROM applications a 
      LEFT JOIN services s ON a.service_id = s.id 
    `;
    
    let params = [];
    
    if (phone) {
      query += ' WHERE a.user_phone = $1';
      params.push(phone);
    }
    
    query += ' ORDER BY a.created_at DESC';
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rowCount
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// 7. Create Application
app.post('/api/applications', async (req, res) => {
  try {
    const { user_name, user_phone, service_id, service_name, aadhaar_number, address, additional_info } = req.body;
    
    console.log('📦 Application submission:', { user_name, user_phone, service_name });
    
    if (!user_name || !user_phone || !service_name) {
      return res.status(400).json({
        success: false,
        message: 'User name, phone and service name are required'
      });
    }

    const registration_no = 'APP-' + Date.now();
    
    const result = await pool.query(
      `INSERT INTO applications 
       (user_name, user_phone, service_id, service_name, aadhaar_number, address, additional_info, registration_no, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [user_name, user_phone, service_id, service_name, aadhaar_number, address, additional_info, registration_no, 'pending']
    );
    
    // Add to application history
    await pool.query(
      'INSERT INTO application_history (application_id, status, remarks) VALUES ($1, $2, $3)',
      [result.rows[0].id, 'pending', 'Application submitted successfully']
    );
    
    console.log('✅ Application submitted successfully for:', user_name);
    
    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Application submission error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// 8. Update Application Status
app.put('/api/applications/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks, updated_by } = req.body;
    
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const result = await pool.query(
      'UPDATE applications SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }
    
    // Add to application history
    await pool.query(
      'INSERT INTO application_history (application_id, status, remarks, updated_by) VALUES ($1, $2, $3, $4)',
      [id, status, remarks || 'Status updated', updated_by || 'admin']
    );
    
    res.json({
      success: true,
      message: 'Application status updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// 9. Authentication - Login - WITHOUT PASSWORD HASHING
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    
    console.log('🔐 Login attempt:', { phone, password });
    
    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Phone and password are required'
      });
    }

    // Find user
    const userResult = await pool.query(
      'SELECT * FROM users WHERE phone = $1 AND is_active = true',
      [phone]
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ User not found:', phone);
      return res.status(401).json({
        success: false,
        message: 'Invalid phone or password'
      });
    }
    
    const user = userResult.rows[0];
    
    // SIMPLE PASSWORD CHECK (NO HASHING)
    console.log('🔍 Password check - Stored:', user.password, 'Provided:', password);
    if (user.password !== password) {
      console.log('❌ Password mismatch for user:', user.name);
      return res.status(401).json({
        success: false,
        message: 'Invalid phone or password'
      });
    }
    
    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, phone: user.phone },
      process.env.JWT_SECRET || 'seva-kendra-secret-key-2024',
      { expiresIn: '24h' }
    );
    
    console.log('✅ Login successful for:', user.name, 'Role:', user.role);
    
    res.json({
      success: true,
      message: 'Login successful',
      token: token,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health Check: http://localhost:${PORT}/health`);
  console.log(`📋 Available Endpoints:`);
  console.log(`   GET  /`);
  console.log(`   GET  /health`);
  console.log(`   GET  /api/services`);
  console.log(`   GET  /api/users`);
  console.log(`   POST /api/users/register`);
  console.log(`   GET  /api/applications`);
  console.log(`   POST /api/applications`);
  console.log(`   PUT  /api/applications/:id/status`);
  console.log(`   POST /api/auth/login`);
});

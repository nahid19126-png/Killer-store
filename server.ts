import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database('playstore.db');

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    developer TEXT DEFAULT 'Killer Store Developer',
    description TEXT,
    icon_url TEXT,
    screenshot_url TEXT,
    download_url TEXT,
    category TEXT,
    rating REAL DEFAULT 4.4,
    reviews_count TEXT DEFAULT '8K',
    content_rating TEXT DEFAULT 'Rated for 3+',
    tags TEXT,
    size TEXT DEFAULT '11 MB',
    is_editors_choice INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER,
    user_id INTEGER,
    user_name TEXT,
    rating INTEGER,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(app_id) REFERENCES apps(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    app_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, app_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(app_id) REFERENCES apps(id)
  );

  CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    points INTEGER DEFAULT 0,
    last_claim DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Ensure role column exists (in case table was created before role was added)
try {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
} catch (e) {}

// Ensure developer column exists
try {
  db.exec("ALTER TABLE apps ADD COLUMN developer TEXT DEFAULT 'Killer Store Developer'");
} catch (e) {}

try {
  db.exec("ALTER TABLE apps ADD COLUMN reviews_count TEXT DEFAULT '8K'");
} catch (e) {}

try {
  db.exec("ALTER TABLE apps ADD COLUMN content_rating TEXT DEFAULT 'Rated for 3+'");
} catch (e) {}

try {
  db.exec("ALTER TABLE apps ADD COLUMN tags TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE apps ADD COLUMN icon_url TEXT");
} catch (e) {}

// Seed Admin User
const seedAdmin = () => {
  const adminUsername = 'nahidadmin';
  const adminPassword = 'admin@123';
  
  const admin = db.prepare('SELECT * FROM users WHERE email = ?').get(adminUsername);
  if (!admin) {
    // Check if old admin exists and update it, or create new
    const oldAdmin = db.prepare('SELECT * FROM users WHERE role = ?').get('admin');
    if (oldAdmin) {
      db.prepare('UPDATE users SET email = ?, password = ? WHERE id = ?')
        .run(adminUsername, adminPassword, oldAdmin.id);
      console.log('Admin user updated to nahidadmin');
    } else {
      db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
        .run('Admin', adminUsername, adminPassword, 'admin');
      console.log('Admin user seeded as nahidadmin');
    }
  } else {
    // Ensure password is correct for the seeded admin
    db.prepare('UPDATE users SET password = ? WHERE email = ?')
      .run(adminPassword, adminUsername);
    console.log('Admin user nahidadmin already exists, password verified');
  }
};
seedAdmin();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Logging Middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // --- API Routes ---

  // Register Endpoint
  app.post('/api/register', (req, res) => {
    console.log('Register attempt:', req.body.email);
    const { name, email, password } = req.body;
    try {
      const stmt = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)');
      const info = stmt.run(name, email, password, 'user');
      console.log('Register success:', email);
      res.setHeader('Content-Type', 'application/json');
      res.json({ success: true, user: { id: info.lastInsertRowid, name, email, role: 'user' } });
    } catch (err: any) {
      console.error('Register error:', err.message);
      res.setHeader('Content-Type', 'application/json');
      if (err.message.includes('UNIQUE constraint failed')) {
        res.status(400).json({ success: false, message: 'Email already exists' });
      } else {
        res.status(500).json({ success: false, message: 'Database error' });
      }
    }
  });

  // Login Endpoint
  app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const trimmedEmail = email?.trim();
    console.log(`Login attempt for: "${trimmedEmail}" with password: "${password}"`);
    
    try {
      // Case-insensitive email check for better UX
      const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND password = ?').get(trimmedEmail, password) as any;
      
      res.setHeader('Content-Type', 'application/json');
      if (user) {
        console.log('Login success for:', trimmedEmail, 'Role:', user.role);
        res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
      } else {
        console.log('Login failed: Invalid credentials for', trimmedEmail);
        
        // Detailed log for debugging
        const userExists = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(trimmedEmail) as any;
        if (userExists) {
          console.log(`DEBUG: User "${trimmedEmail}" exists. Stored password: "${userExists.password}". Provided password: "${password}"`);
          if (userExists.password !== password) {
            console.log('DEBUG: Password mismatch detected.');
          }
        } else {
          console.log(`DEBUG: User "${trimmedEmail}" does not exist in database.`);
          // List all users for debugging
          const allUsers = db.prepare('SELECT email FROM users').all();
          console.log('DEBUG: Current users in DB:', allUsers.map((u: any) => u.email).join(', '));
        }
        
        res.status(401).json({ success: false, message: 'Invalid email or password' });
      }
    } catch (err: any) {
      console.error('Login error:', err.message);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ success: false, message: 'Database error' });
    }
  });

  // --- App Management API ---

  // Get Editor's Choice
  app.get('/api/apps/editors-choice', (req, res) => {
    try {
      const apps = db.prepare('SELECT * FROM apps WHERE is_editors_choice = 1').all();
      res.json({ success: true, apps });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Reviews API
  app.get('/api/apps/:id/reviews', (req, res) => {
    const apps = db.prepare('SELECT * FROM reviews WHERE app_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json({ success: true, reviews: apps });
  });

  app.post('/api/apps/:id/reviews', (req, res) => {
    const { user_id, user_name, rating, comment } = req.body;
    db.prepare('INSERT INTO reviews (app_id, user_id, user_name, rating, comment) VALUES (?, ?, ?, ?, ?)')
      .run(req.params.id, user_id, user_name, rating, comment);
    res.json({ success: true });
  });

  // Wishlist API
  app.post('/api/wishlist', (req, res) => {
    const { user_id, app_id } = req.body;
    try {
      db.prepare('INSERT INTO wishlist (user_id, app_id) VALUES (?, ?)').run(user_id, app_id);
      res.json({ success: true });
    } catch (e) {
      db.prepare('DELETE FROM wishlist WHERE user_id = ? AND app_id = ?').run(user_id, app_id);
      res.json({ success: true, removed: true });
    }
  });

  app.get('/api/wishlist/:user_id', (req, res) => {
    const apps = db.prepare(`
      SELECT apps.* FROM apps 
      JOIN wishlist ON apps.id = wishlist.app_id 
      WHERE wishlist.user_id = ?
    `).all(req.params.user_id);
    res.json({ success: true, apps });
  });

  // Rewards API
  app.get('/api/rewards/:user_id', (req, res) => {
    let reward = db.prepare('SELECT * FROM rewards WHERE user_id = ?').get(req.params.user_id) as any;
    if (!reward) {
      db.prepare('INSERT INTO rewards (user_id, points) VALUES (?, 0)').run(req.params.user_id);
      reward = { points: 0 };
    }
    res.json({ success: true, points: reward.points });
  });

  app.post('/api/rewards/claim', (req, res) => {
    const { user_id, amount } = req.body;
    const points = amount || 10; // Use provided amount or default to 10
    db.prepare('UPDATE rewards SET points = points + ? WHERE user_id = ?').run(points, user_id);
    res.json({ success: true, added: points });
  });

  // Upload App
  app.post('/api/apps', (req, res) => {
    const { name, developer, description, icon_url, screenshot_url, download_url, category, size, rating, reviews_count, content_rating, tags } = req.body;
    try {
      const stmt = db.prepare(`
        INSERT INTO apps (name, developer, description, icon_url, screenshot_url, download_url, category, size, rating, reviews_count, content_rating, tags) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        name, 
        developer || 'Killer Store Developer', 
        description, 
        icon_url,
        screenshot_url, 
        download_url, 
        category, 
        size || '11 MB',
        rating || 4.4,
        reviews_count || '8K',
        content_rating || 'Rated for 3+',
        tags || ''
      );
      res.json({ success: true, app: { id: info.lastInsertRowid, name, category } });
    } catch (err: any) {
      console.error('Upload error:', err.message);
      res.status(500).json({ success: false, message: 'Database error' });
    }
  });

  // Get All Apps
  app.get('/api/apps', (req, res) => {
    try {
      const apps = db.prepare('SELECT * FROM apps ORDER BY created_at DESC').all();
      res.json({ success: true, apps });
    } catch (err: any) {
      console.error('Fetch apps error:', err.message);
      res.status(500).json({ success: false, message: 'Database error' });
    }
  });

  // Delete All Apps (To remove demo apps as requested)
  app.delete('/api/apps/clear', (req, res) => {
    try {
      db.prepare('DELETE FROM apps').run();
      res.json({ success: true, message: 'All apps cleared' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Update App
  app.put('/api/apps/:id', (req, res) => {
    const { name, developer, description, icon_url, screenshot_url, download_url, category, size, rating, reviews_count, tags, admin_secret } = req.body;
    
    // Simple admin check (in a real app, use sessions/tokens)
    if (admin_secret !== 'admin@123') {
      return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
    }

    try {
      db.prepare(`
        UPDATE apps SET 
          name = ?, developer = ?, description = ?, icon_url = ?, 
          screenshot_url = ?, download_url = ?, category = ?, 
          size = ?, rating = ?, reviews_count = ?, tags = ?
        WHERE id = ?
      `).run(name, developer, description, icon_url, screenshot_url, download_url, category, size, rating, reviews_count, tags, req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Delete Individual App
  app.delete('/api/apps/:id', (req, res) => {
    const { admin_secret } = req.body;

    if (admin_secret !== 'admin@123') {
      return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
    }

    try {
      db.prepare('DELETE FROM apps WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // --- Vite Integration ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    // SPA Fallback for production
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();

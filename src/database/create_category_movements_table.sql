-- Create category_movements table to track email movements between categories
-- This will help with machine learning and category prediction improvements

CREATE TABLE IF NOT EXISTS category_movements (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
    from_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    to_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    sender VARCHAR(255) NOT NULL,
    ai_summary TEXT,
    moved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_category_movements_user_id ON category_movements(user_id);
CREATE INDEX IF NOT EXISTS idx_category_movements_email_id ON category_movements(email_id);
CREATE INDEX IF NOT EXISTS idx_category_movements_from_category ON category_movements(from_category_id);
CREATE INDEX IF NOT EXISTS idx_category_movements_to_category ON category_movements(to_category_id);
CREATE INDEX IF NOT EXISTS idx_category_movements_sender ON category_movements(sender);
CREATE INDEX IF NOT EXISTS idx_category_movements_moved_at ON category_movements(moved_at);
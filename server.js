const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from 'public' directory

// In-memory session storage (use Redis or database in production)
const sessions = new Map();

// Session configuration
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

// Helper function to generate session ID
function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

// Helper function to validate trace data
function validateTraceData(traceData, outlineType) {
    const { path, accuracy, coverage, jitter } = traceData;
    
    // Basic validation
    if (!path || path.length < 40) {
        return { valid: false, reason: 'Trace too short' };
    }
    
    // Coverage check
    if (coverage < 0.70) {
        return { valid: false, reason: 'Insufficient coverage of the shape' };
    }
    
    // Bot detection - too perfect movement
    if (accuracy < 4 && jitter < 0.0015) {
        return { valid: false, reason: 'Movement pattern appears suspicious' };
    }
    
    // Accuracy check
    if (accuracy < 25 && coverage >= 0.70) {
        return { valid: true, reason: 'Valid human trace' };
    }
    
    return { valid: false, reason: 'Trace does not match shape adequately' };
}

// Cleanup old sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.createdAt > SESSION_TIMEOUT) {
            sessions.delete(sessionId);
        }
    }
}, 60000); // Run every minute

// API Routes

// Initialize a new CAPTCHA session
app.post('/api/captcha/init', (req, res) => {
    const sessionId = generateSessionId();
    const session = {
        id: sessionId,
        createdAt: Date.now(),
        attemptsLeft: MAX_ATTEMPTS,
        verified: false,
        outlineType: null
    };
    
    sessions.set(sessionId, session);
    
    res.json({
        success: true,
        sessionId,
        attemptsLeft: MAX_ATTEMPTS
    });
});

// Get session status
app.get('/api/captcha/status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({
            success: false,
            error: 'Session not found or expired'
        });
    }
    
    res.json({
        success: true,
        attemptsLeft: session.attemptsLeft,
        verified: session.verified
    });
});

// Verify a trace submission
app.post('/api/captcha/verify', (req, res) => {
    const { sessionId, traceData, outlineType } = req.body;
    
    // Validate session
    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            success: false,
            error: 'Session not found or expired'
        });
    }
    
    // Check if already verified
    if (session.verified) {
        return res.json({
            success: true,
            verified: true,
            message: 'Already verified'
        });
    }
    
    // Check attempts remaining
    if (session.attemptsLeft <= 0) {
        return res.status(403).json({
            success: false,
            error: 'No attempts remaining',
            attemptsLeft: 0
        });
    }
    
    // Validate trace data
    const validation = validateTraceData(traceData, outlineType);
    
    if (validation.valid) {
        session.verified = true;
        session.verifiedAt = Date.now();
        
        return res.json({
            success: true,
            verified: true,
            message: 'CAPTCHA verified successfully',
            attemptsLeft: session.attemptsLeft
        });
    } else {
        session.attemptsLeft--;
        
        return res.json({
            success: false,
            verified: false,
            reason: validation.reason,
            attemptsLeft: session.attemptsLeft
        });
    }
});

// Reset a session (for retry)
app.post('/api/captcha/reset/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({
            success: false,
            error: 'Session not found or expired'
        });
    }
    
    // Reset session but keep attempts tracking
    session.verified = false;
    session.verifiedAt = null;
    
    res.json({
        success: true,
        attemptsLeft: session.attemptsLeft
    });
});

// Validate if a session is verified (for protected routes)
app.post('/api/captcha/validate', (req, res) => {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({
            valid: false,
            error: 'Session not found or expired'
        });
    }
    
    if (!session.verified) {
        return res.status(403).json({
            valid: false,
            error: 'CAPTCHA not verified'
        });
    }
    
    res.json({
        valid: true,
        message: 'Session verified'
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        activeSessions: sessions.size,
        timestamp: new Date().toISOString()
    });
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`CAPTCHA Backend Server running on http://localhost:${PORT}`);
    console.log(`API endpoints available at http://localhost:${PORT}/api`);
});
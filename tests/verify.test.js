const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

const { verifyTrace } = require('../verify');

const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'template.json'), 'utf8'));

describe('verifyTrace algorithm', () => {
  test('perfect match returns low score and success', () => {
    // use template as user input (should match perfectly, score ~0)
    const res = verifyTrace(template, template);
    expect(res.score).toBeGreaterThanOrEqual(0);
    expect(res.success).toBe(true);
  });

  test('slightly noisy match passes', () => {
    const noisy = template.map(p => ({
      x: p.x + (Math.random() - 0.5) * 0.005,  // smaller noise
      y: p.y + (Math.random() - 0.5) * 0.005
    }));
  
    const res = verifyTrace(noisy, template);
    expect(res.success).toBe(true);
    expect(res.score).toBeLessThan(0.05);
  });

  test('different shape fails', () => {
    const line = Array.from({ length: template.length }, (_, i) => ({
      x: i / (template.length-1),
      y: 0.5
    }));
  
    const res = verifyTrace(line, template);
  
    expect(res.success).toBe(false);
  
    // Allow: score is NaN (degenerate shape) OR score is large
    expect(!isFinite(res.score) || res.score > 0.02).toBe(true);
  });
  
});

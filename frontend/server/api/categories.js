import { defineEventHandler, createError } from 'h3';
import { getDb } from '../utils/db';
import { requireAuth } from '../utils/authz.js';

export default defineEventHandler(async (event) => {
  requireAuth(event);
  const db = getDb();
  
  // Get all courses
  const categories = new Set();
  
  try {
    // Extract all unique categories from courses
    const courses = db.prepare(`
      SELECT c.data FROM courses c JOIN content_roots r ON r.id=c.content_root_id
      WHERE c.is_available=1 AND r.is_configured=1 AND r.is_available=1
    `).all();
    
    courses.forEach(course => {
      try {
        const courseData = JSON.parse(course.data);
        if (courseData.category && courseData.category.trim() !== '') {
          categories.add(courseData.category);
        }
      } catch (e) {
        console.error('Error parsing course data:', e);
      }
    });
    
    return Array.from(categories).sort();
  } catch (error) {
    console.error('Error getting categories:', error);
    throw createError({ statusCode: 500, statusMessage: 'Failed to load categories' });
  }
});

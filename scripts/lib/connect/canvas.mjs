// Request-based metadata retrieval. No questions, submissions, quiz attempts or
// grade details. A missing optional endpoint remains unavailable, never [].
import { buildRequest, keepFields } from './spec.mjs';

const id = value => /^[1-9][0-9]*$/.test(String(value));
export const canvasId = value => {
  if (!id(value)) throw new Error('Canvas ids must be positive decimal integers');
  return String(value);
};

export async function canvasRead(spec, operation, params, settings, fetchJSON) {
  const request = buildRequest(spec, operation, params, settings);
  if (request.error) throw new Error(request.error);
  if (request.method !== 'GET' || request.write) throw new Error('Canvas snapshots are read-only');
  const first = new URL(request.url), visited = new Set(), pages = [];
  let url = first.href;
  while (url) {
    const next = new URL(url);
    // Link URLs are opaque, but never authority to send the credential elsewhere
    // or to a different resource (including GET endpoints with side effects).
    if (next.origin !== first.origin || next.pathname !== first.pathname || next.username || next.password || next.hash || next.searchParams.has('access_token')) {
      throw new Error('Canvas pagination left the requested resource');
    }
    if (visited.has(url) || visited.size >= 20) throw new Error('Canvas pagination incomplete: repeated page or 20-page limit');
    visited.add(url);
    const response = await fetchJSON(url);
    if (!response.ok) return { status: 'unavailable', http_status: response.status, source_urls: [...visited], retrieved_at: new Date().toISOString() };
    if (Array.isArray(response.body)) pages.push(...response.body);
    else if (visited.size > 1) throw new Error('Canvas pagination returned a non-list');
    const link = response.link ?? '';
    url = [...link.matchAll(/<([^>]+)>\s*;\s*rel="?([^",;]+)"?/g)].find(m => m[2] === 'next')?.[1] ?? null;
    if (!Array.isArray(response.body) && url) throw new Error('Canvas returned pagination for a non-list');
    if (!url) {
      const body = Array.isArray(response.body) ? pages : response.body;
      if (!body || typeof body !== 'object') throw new Error('Canvas returned invalid metadata');
      return { status: 'available', source_urls: [...visited], retrieved_at: new Date().toISOString(), data: keepFields(body, spec.operations[operation].keep, 2000) };
    }
  }
}

export async function canvasCourseSnapshot(spec, courseId, settings, fetchJSON) {
  const course_id = canvasId(courseId);
  const courses = await canvasRead(spec, 'courses', {}, settings, fetchJSON);
  if (courses.status !== 'available' || !Array.isArray(courses.data)) throw new Error('Cannot verify active enrollment in Canvas');
  if (!courses.data.some(c => String(c.id) === course_id)) throw new Error('Requested course is not in your active Canvas enrollments');
  const course = await canvasRead(spec, 'course', { course_id }, settings, fetchJSON);
  if (course.status !== 'available' || String(course.data.id) !== course_id) throw new Error('Canvas course details unavailable or mismatched');
  const resources = {};
  for (const operation of ['assignments', 'quizzes', 'assignment_groups']) {
    resources[operation] = await canvasRead(spec, operation, { course_id }, settings, fetchJSON);
    if (resources[operation].status === 'available' && !Array.isArray(resources[operation].data)) throw new Error(`Canvas ${operation} did not return a list`);
  }
  return { schema_version: 1, course_id, retrieved_at: new Date().toISOString(), course, ...resources };
}

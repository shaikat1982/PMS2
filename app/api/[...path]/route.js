// Unknown API paths answer with JSON instead of the app's HTML 404 page.
const notFound = () => Response.json({ error: 'Not found' }, { status: 404 });

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;

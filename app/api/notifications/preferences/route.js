import * as notifications from '@/server/api/notifications.js';
import { handle } from '@/server/http.js';

export const GET = handle(notifications.preferences);
export const PUT = handle(notifications.savePreferences);

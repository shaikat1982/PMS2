import * as notifications from '@/server/api/notifications.js';
import { handle } from '@/server/http.js';

export const POST = handle(notifications.testEmail);

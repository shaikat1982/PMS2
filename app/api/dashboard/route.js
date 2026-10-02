import * as dashboard from '@/server/api/dashboard.js';
import { handle } from '@/server/http.js';

export const GET = handle(dashboard.summary);

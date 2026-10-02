import * as attachments from '@/server/api/attachments.js';
import { handle } from '@/server/http.js';

export const POST = handle(attachments.upload, { json: false });

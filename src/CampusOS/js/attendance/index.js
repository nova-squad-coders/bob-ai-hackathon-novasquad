import { bootstrap, runPage } from '../core/app.js?v=5';
import { initAttendance } from './attendance.js?v=5';

bootstrap('attendance').then(() => runPage(initAttendance));

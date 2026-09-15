import { bootstrap, runPage } from '../core/app.js?v=5';
import { initTasks } from './tasks.js?v=5';

bootstrap('tasks').then(() => runPage(initTasks));

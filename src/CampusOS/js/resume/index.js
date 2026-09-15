import { bootstrap, runPage } from '../core/app.js?v=5';
import { initResume } from './resume.js?v=5';

bootstrap('resume').then(() => runPage(initResume));

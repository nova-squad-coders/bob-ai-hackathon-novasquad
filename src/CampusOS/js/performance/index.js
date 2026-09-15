import { bootstrap, runPage } from '../core/app.js?v=5';
import { initPerformance } from './performance.js?v=5';

bootstrap('performance').then(() => runPage(initPerformance));

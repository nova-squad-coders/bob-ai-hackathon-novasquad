import { bootstrap, runPage } from '../core/app.js?v=5';
import { initCopilot } from './copilot.js?v=1';

bootstrap('copilot').then(() => runPage(initCopilot));

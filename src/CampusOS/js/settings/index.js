import { bootstrap, runPage } from '../core/app.js?v=5';
import { initSettings } from './settings.js?v=5';

bootstrap('settings').then(() => runPage(initSettings));

import { bootstrap, runPage } from '../core/app.js?v=5';
import { renderDashboard } from './dashboard.js?v=5';

bootstrap('dashboard').then(() => runPage(renderDashboard));

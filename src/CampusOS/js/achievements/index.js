import { bootstrap, runPage } from '../core/app.js?v=5';
import { initAchievements } from './achievements.js?v=5';

bootstrap('achievements').then(() => runPage(initAchievements));

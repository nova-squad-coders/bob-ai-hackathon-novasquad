import { bootstrap, runPage } from '../core/app.js?v=5';
import { initSpendee } from './spendee.js?v=5';

bootstrap('spendee').then(() => runPage(initSpendee));

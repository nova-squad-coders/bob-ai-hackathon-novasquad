import { bootstrap, runPage } from '../core/app.js?v=5';
import { initPeople } from './people.js?v=5';

bootstrap('people').then(() => runPage(initPeople));

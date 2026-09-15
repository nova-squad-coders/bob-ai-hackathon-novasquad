import { bootstrap, runPage } from '../core/app.js?v=5';
import { initLibrary } from './library.js?v=5';

bootstrap('library').then(() => runPage(initLibrary));

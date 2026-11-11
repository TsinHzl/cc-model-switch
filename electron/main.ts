import { userInfo } from 'node:os';
import { bootstrap } from './bootstrap';

void bootstrap({ resolveHome: () => userInfo().homedir });

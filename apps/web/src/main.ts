import { createApp } from 'vue';

import App from './App.vue';
import './styles/base.css';

// P0-01 只挂载最小应用外壳；router、pinia 与 api 层由 P0-06 搭建
createApp(App).mount('#app');

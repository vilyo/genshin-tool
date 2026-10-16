import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import './styles/base.css'
import './styles/tokens.css'
import './styles/fonts.css'
import './styles/board.css'

createApp(App).use(createPinia()).mount('#app')

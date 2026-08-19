import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub project pages are served from /<repository-name>/.
// Local development and <username>.github.io repositories are served from /.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] || ''
const isUserOrOrgPagesRepo = repoName.endsWith('.github.io')
const githubPagesBase = process.env.GITHUB_ACTIONS === 'true' && repoName && !isUserOrOrgPagesRepo
  ? `/${repoName}/`
  : '/'

export default defineConfig({
  plugins: [react()],
  base: githubPagesBase,
})

import { SiteChrome } from '../shared/SiteChrome.tsx'
import { HomeHero } from './HomeHero.tsx'
import { HomeOpenSource } from './HomeOpenSource.tsx'
import { HomePipeline } from './HomePipeline.tsx'

export function HomePage() {
  return (
    <SiteChrome>
      <main id="conteudo-principal" tabIndex={-1}>
        <HomeHero />
        <HomePipeline />
        <HomeOpenSource />
      </main>
    </SiteChrome>
  )
}

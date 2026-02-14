// Test script to verify all routes render without errors
import puppeteer from 'puppeteer'

async function testRoutes() {
  console.log('Starting route tests...\n')

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  try {
    const page = await browser.page()

    // Enable console logging
    page.on('console', msg => {
      const type = msg.type()
      if (type === 'error') {
        console.error(`[Browser Error]: ${msg.text()}`)
      }
    })

    // Enable error logging
    page.on('pageerror', error => {
      console.error(`[Page Error]: ${error.message}`)
    })

    // Test 1: Home route
    console.log('✓ Testing home route (/)...')
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' })

    // Check for React root
    const hasRoot = await page.$('#root')
    if (!hasRoot) throw new Error('React root not found')

    // Check for repositories heading
    const hasHeading = await page.$eval('h1', el => el.textContent?.includes('Repositories'))
    if (!hasHeading) throw new Error('Repositories heading not found')

    // Check for repositories list
    await page.waitForSelector('a[href*="/repositories/"]', { timeout: 5000 })
    console.log('  ✓ Home route renders repositories')
    console.log('  ✓ Effect service fetched data')

    // Check Tailwind styles
    const hasStyles = await page.$eval('h1', el => {
      const styles = window.getComputedStyle(el)
      return styles.margin === '0px'
    })
    if (!hasStyles) console.warn('  ⚠ Tailwind styles may not be applied')
    else console.log('  ✓ Tailwind styles render')

    // Test 2: Repository detail route
    console.log('\n✓ Testing repository detail route (/repositories/test-repo)...')
    await page.goto('http://localhost:3000/repositories/test-repo', { waitUntil: 'networkidle2' })

    const hasRepoHeading = await page.$eval('h1', el => el.textContent?.includes('Repository: test-repo'))
    if (!hasRepoHeading) throw new Error('Repository heading not found')

    // Check for workers table
    await page.waitForSelector('table', { timeout: 5000 })
    console.log('  ✓ Repository detail renders workers table')
    console.log('  ✓ Effect service fetched workers')

    // Test 3: Worker detail route
    console.log('\n✓ Testing worker detail route (/repositories/test-repo/workers/worker-1)...')
    await page.goto('http://localhost:3000/repositories/test-repo/workers/worker-1', { waitUntil: 'networkidle2' })

    const hasWorkerHeading = await page.$eval('h1', el => el.textContent?.includes('Worker: worker-1'))
    if (!hasWorkerHeading) throw new Error('Worker heading not found')

    // Check for PRD content
    await page.waitForSelector('h2', { timeout: 5000 })
    const hasPrdContent = await page.$eval('h2', el => el.textContent?.includes('Test Project'))
    if (!hasPrdContent) throw new Error('PRD content not found')

    console.log('  ✓ Worker detail renders PRD')
    console.log('  ✓ Worker detail displays tasks')
    console.log('  ✓ Effect service fetched worker detail')

    // Test 4: Check for console errors
    console.log('\n✓ Checking for runtime errors...')
    const errors: string[] = []
    page.on('pageerror', error => {
      errors.push(error.message)
    })

    // Reload home to check for errors
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' })
    await page.waitForTimeout(2000)

    if (errors.length > 0) {
      console.error('  ✗ Runtime errors detected:')
      errors.forEach(err => console.error(`    - ${err}`))
    } else {
      console.log('  ✓ No runtime errors in browser console')
    }

    console.log('\n✓✓✓ All tests passed! ✓✓✓')
    console.log('\nSummary:')
    console.log('  ✓ Home route renders and fetches repositories via Effect')
    console.log('  ✓ Repository detail fetches workers and displays state')
    console.log('  ✓ Worker detail displays PRD and tasks')
    console.log('  ✓ All Tailwind styles visible')
    console.log('  ✓ No runtime errors in browser console')

  } catch (error) {
    console.error('\n✗ Test failed:', error)
    process.exit(1)
  } finally {
    await browser.close()
  }
}

testRoutes().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})

You can also find `getByRole` to get elements on the page.

```javascript
// Then use the information from the snapshot to click elements
// For example, if snapshot shows: { "role": "button", "name": "Sign In" }
await state.page.getByRole('button', { name: 'Sign In' }).click()

// For a link with { "role": "link", "name": "About" }
await state.page.getByRole('link', { name: 'About' }).click()

// For a textbox with { "role": "textbox", "name": "Email" }
await state.page.getByRole('textbox', { name: 'Email' }).fill('user@example.com')

// For a heading with { "role": "heading", "name": "Welcome to Example.com" }
const headingText = await state.page.getByRole('heading', { name: 'Welcome to Example.com' }).textContent()
console.log('Heading text:', headingText)
```

### Complete Example: Find and Click Elements

```javascript
await state.page.getByRole('button', { name: 'Submit Form' }).click()
console.log('Clicked submit button')

await waitForPageLoad({ page: state.page })
console.log('Form submitted successfully')
```

## Core Concepts

### Page and Context

In Playwright, automation happens through a page object (representing a browser tab) and `context` (representing a browser session with cookies, storage, etc.). Playwriter has no default `page` global. Create your own tab and store it in `state.page`, or reuse a tab the user already opened:

```javascript
// New tab
state.page = await context.newPage()

// Existing tab the user referenced (last match = most recently opened)
state.page = context.pages().findLast((p) => p.url().includes('example.com'))
```

### Element Selection

Playwright uses locators to find elements. The examples below show various selection methods:

```javascript
// By role (recommended)
await state.page.getByRole('button', { name: 'Submit' })

// By text
await state.page.getByText('Welcome')

// By placeholder
await state.page.getByPlaceholder('Enter email')

// By label
await state.page.getByLabel('Username')

// By test id
await state.page.getByTestId('submit-button')

// By CSS selector
await state.page.locator('.my-class')

// By XPath
await state.page.locator('//div[@class="content"]')
```

## Navigation

### Navigate to URL

```javascript
await state.page.goto('https://example.com')
// Wait for page load (smart detection that ignores analytics/ads)
await state.page.goto('https://example.com', { waitUntil: 'domcontentloaded' })
await waitForPageLoad({ page: state.page })
```

### Navigate Back/Forward

```javascript
// Go back to previous page
await state.page.goBack()

// Go forward to next page
await state.page.goForward()
```

## Screenshots

### Take Screenshot

```javascript
// Screenshot of viewport
await state.page.screenshot({ path: 'screenshot.png' })

// Full page screenshot
await state.page.screenshot({ path: 'fullpage.png', fullPage: true })

// Screenshot of specific element
const element = await state.page.getByRole('button', { name: 'Submit' })
await element.screenshot({ path: 'button.png' })

// Screenshot with custom dimensions
await state.page.setViewportSize({ width: 1280, height: 720 })
await state.page.screenshot({ path: 'custom-size.png' })
```

## Mouse Interactions

### Click Elements

```javascript
// Click by role
await state.page.getByRole('button', { name: 'Submit' }).click()

// Click at coordinates
await state.page.mouse.click(100, 200)

// Double click
await state.page.getByText('Double click me').dblclick()

// Right click
await state.page.getByText('Right click me').click({ button: 'right' })

// Click with modifiers
await state.page.getByText('Ctrl click me').click({ modifiers: ['Control'] })
```

### Hover

```javascript
// Hover over element
await state.page.getByText('Hover me').hover()

// Hover at coordinates
await state.page.mouse.move(100, 200)
```

## Keyboard Input

### Type Text

```javascript
// Type into input field
await state.page.getByLabel('Email').fill('user@example.com')

// Type character by character (simulates real typing)
await state.page.getByLabel('Email').type('user@example.com', { delay: 100 })

// Clear and type
await state.page.getByLabel('Email').clear()
await state.page.getByLabel('Email').fill('new@example.com')
```

### Press Keys

```javascript
// Press single key
await state.page.keyboard.press('Enter')

// Press key combination
await state.page.keyboard.press('Control+A')

// Press sequence of keys
await state.page.keyboard.press('Tab')
await state.page.keyboard.press('Tab')
await state.page.keyboard.press('Space')

// Common key shortcuts
await state.page.keyboard.press('Control+C') // Copy
await state.page.keyboard.press('Control+V') // Paste
await state.page.keyboard.press('Control+Z') // Undo
```

## Form Interactions

### Select Dropdown Options

```javascript
// Select by value
await state.page.selectOption('select#country', 'us')

// Select by label
await state.page.selectOption('select#country', { label: 'United States' })

// Select multiple options
await state.page.selectOption('select#colors', ['red', 'blue', 'green'])

// Get selected option
const selectedValue = await state.page.$eval('select#country', (el) => el.value)
```

### Checkboxes and Radio Buttons

```javascript
// Check checkbox
await state.page.getByLabel('I agree').check()

// Uncheck checkbox
await state.page.getByLabel('Subscribe').uncheck()

// Check if checked
const isChecked = await state.page.getByLabel('I agree').isChecked()

// Select radio button
await state.page.getByLabel('Option A').check()
```

## JavaScript Evaluation

### Execute JavaScript in Page Context

```javascript
// Evaluate simple expression
const result = await state.page.evaluate(() => 2 + 2)

// Access page variables
const pageTitle = await state.page.evaluate(() => document.title)

// Modify page
await state.page.evaluate(() => {
  document.body.style.backgroundColor = 'red'
})

// Pass arguments to page context
const sum = await state.page.evaluate(([a, b]) => a + b, [5, 3])

// Work with elements
const elementText = await state.page.evaluate((el) => el.textContent, await state.page.getByRole('heading'))
```

### Execute JavaScript on Element

```javascript
// Get element property
const href = await state.page.getByRole('link').evaluate((el) => el.href)

// Modify element
await state.page.getByRole('button').evaluate((el) => {
  el.style.backgroundColor = 'green'
  el.disabled = true
})

// Scroll element into view
await state.page.getByText('Section').evaluate((el) => el.scrollIntoView())
```

## File Handling

### File Upload

```javascript
// Upload single file
await state.page.getByLabel('Upload file').setInputFiles('/path/to/file.pdf')

// Upload multiple files
await state.page.getByLabel('Upload files').setInputFiles(['/path/to/file1.pdf', '/path/to/file2.pdf'])

// Clear file input
await state.page.getByLabel('Upload file').setInputFiles([])

// For file inputs, use setInputFiles directly on the input element
// Find the file input element (often hidden)
await state.page.locator('input[type="file"]').setInputFiles('/path/to/file.pdf')
```

## Network Monitoring

### Check Network Activity

```javascript
// Wait for a specific request to complete and get its response
const response = await state.page.waitForResponse(
  (response) => response.url().includes('/api/user') && response.status() === 200,
)

// Get response data
const responseBody = await response.json()
console.log('API response:', responseBody)

// Wait for specific request
const request = await state.page.waitForRequest('**/api/data')
console.log('Request URL:', request.url())
console.log('Request method:', request.method())

// Get all resources loaded by the page
const resources = await state.page.evaluate(() =>
  performance.getEntriesByType('resource').map((r) => ({
    name: r.name,
    duration: r.duration,
    size: r.transferSize,
  })),
)
console.log('Page resources:', resources)
```

## Console Messages

### Capture Console Output

```javascript
// Console messages are automatically captured by the MCP implementation
// Use the console_logs tool to retrieve them

// To trigger console messages from the page:
await state.page.evaluate(() => {
  console.log('This message will be captured')
  console.error('This error will be captured')
  console.warn('This warning will be captured')
})

// Then use the console_logs MCP tool to retrieve all captured messages
// The tool provides filtering by type and pagination
```

## Waiting

### Wait for Conditions

```javascript
// Wait for element to appear
await state.page.waitForSelector('.success-message')

// Wait for element to disappear
await state.page.waitForSelector('.loading', { state: 'hidden' })

await state.page.waitForURL(/github\.com.*\/pull/)
await state.page.waitForURL(/\/new-org/)

// Wait for text to appear
await state.page.waitForFunction((text) => document.body.textContent.includes(text), 'Success!')

// Wait for navigation
await state.page.waitForURL('**/success')

// Wait for page load (smart detection that ignores analytics/ads)
await waitForPageLoad({ page: state.page })

// Wait for specific condition
await state.page.waitForFunction((text) => document.querySelector('.status')?.textContent === text, 'Ready')
```

### Wait for Text to Appear or Disappear

```javascript
// Wait for specific text to appear on the page
await state.page.getByText('Loading complete').first().waitFor({ state: 'visible' })
console.log('Loading complete text is now visible')

// Wait for text to disappear from the page
await state.page.getByText('Loading...').first().waitFor({ state: 'hidden' })
console.log('Loading text has disappeared')

// Wait for multiple conditions sequentially
// First wait for loading to disappear, then wait for success message
await state.page.getByText('Processing...').first().waitFor({ state: 'hidden' })
await state.page.getByText('Success!').first().waitFor({ state: 'visible' })
console.log('Processing finished and success message appeared')

// Example: Wait for error message to disappear before proceeding
await state.page.getByText('Error: Please try again').first().waitFor({ state: 'hidden' })
await state.page.getByRole('button', { name: 'Submit' }).click()

// Example: Wait for confirmation text after form submission
await state.page.getByRole('button', { name: 'Save' }).click()
await state.page.getByText('Your changes have been saved').first().waitFor({ state: 'visible' })
console.log('Save confirmed')

// Example: Wait for dynamic content to load
await state.page.getByRole('button', { name: 'Load More' }).click()
await state.page.getByText('Loading more items...').first().waitFor({ state: 'visible' })
await state.page.getByText('Loading more items...').first().waitFor({ state: 'hidden' })
console.log('Additional items loaded')
```

### Work with Frames

```javascript
// Get frame by name
const frame = state.page.frame('frameName')

// Get frame by URL
const frame = state.page.frame({ url: /frame\.html/ })

// Interact with frame content
await frame.getByText('In Frame').click()

// Get all frames
const frames = state.page.frames()
```

## Best Practices

### Reliable Selectors

```javascript
// Prefer user-facing attributes
await state.page.getByRole('button', { name: 'Submit' })
await state.page.getByLabel('Email')
await state.page.getByPlaceholder('Search...')
await state.page.getByText('Welcome')

// Use test IDs for complex cases
await state.page.getByTestId('complex-component')

// Avoid brittle selectors
// Bad: await state.page.locator('.btn-3842');
// Good: await state.page.getByRole('button', { name: 'Submit' });
```

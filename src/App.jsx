import { useState } from 'react'
import { Config } from './config'
import Experience from './components/Experience/Experience'
import Overlay from './components/Overlay/Overlay'
import FluidCursor from './components/FluidCursor'

function App() {
  const [error, setError] = useState(null)

  return (
    <>
      <Experience setError={setError} />
      <Overlay error={error} />
      {Config.enableFluid && <FluidCursor />}
    </>
  )
}

export default App

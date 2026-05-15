import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="login-page">
          <section className="login-card">
            <h1>MedQuest Anki</h1>
            <p>O app encontrou um erro ao processar essa ação. Recarregue a página e tente novamente.</p>
            <div className="alert bad">{this.state.error.message || String(this.state.error)}</div>
            <button onClick={() => window.location.reload()}>Recarregar</button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)

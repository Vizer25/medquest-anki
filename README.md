# MedQuest Anki

Site React/Vite para revisar flashcards do Anki com XP, níveis, streak e resposta digitada.

## Como rodar

```bash
npm install
npm run dev
```

## Como publicar na Vercel

```bash
npm install
npm run build
npx vercel --prod
```

## Como importar do Anki

No Anki: Exportar -> Notes in Plain Text / CSV. O arquivo precisa ter 2 colunas:

```csv
frente,verso
"Pergunta","Resposta"
```

Depois use o botão "Escolher CSV" no site.

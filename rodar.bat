@echo off
REM ============================================================
REM  Contact Me - atalho para subir o app e abrir o navegador
REM  Duplo clique neste arquivo. Para parar: feche esta janela
REM  ou aperte Ctrl+C.
REM ============================================================
title Contact Me - servidor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js nao foi encontrado no PATH.
  echo  Instale em https://nodejs.org e abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo  Instalando as dependencias pela primeira vez...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  Falhou instalar as dependencias.
    pause
    exit /b 1
  )
)

if not exist "data\prestadores.json" (
  echo.
  echo  Criando os dados de demonstracao...
  echo.
  call npm run seed
)

echo.
echo  Abrindo http://localhost:3000 no navegador...
echo.
start "" http://localhost:3000

node server.js

echo.
echo  O servidor parou.
pause

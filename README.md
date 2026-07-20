# Direct Managers Dashboard

Дашборд GitHub Pages для таблиць Таї та Катерини.

## Чому новий місяць міг не з’являтися

Сайт не читає Google Таблиці безпосередньо. Він відкриває `data/report.json`.
Файл оновлює GitHub Actions workflow `.github/workflows/update-data.yml`.

Місяці формуються глобально з усіх записів обох direct-менеджерів. Тому для появи серпня достатньо серпневих даних хоча б в одному підтримуваному аркуші.

## Обов’язкове встановлення workflow

Після завантаження проєкту перевірте, що в GitHub реально існує файл:

`.github/workflows/update-data.yml`

Веб-завантаження іноді пропускає папку `.github`. Тому копія workflow також лежить у видимій папці:

`WORKFLOW-FILE/update-data.yml`

Якщо `.github/workflows/update-data.yml` немає:

1. У репозиторії натисніть `Add file → Create new file`.
2. У полі назви введіть `.github/workflows/update-data.yml`.
3. Скопіюйте вміст із `WORKFLOW-FILE/update-data.yml`.
4. Натисніть `Commit changes`.

Потім відкрийте `Actions → Update Google Sheets data → Run workflow`.
Після першого запуску workflow перевіряє таблиці за розкладом приблизно кожні 5 хвилин.

## GitHub Pages

`Settings → Pages → Deploy from a branch → main → /(root)`.

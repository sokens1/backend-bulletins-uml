# Documentation Technique et Fonctionnelle - Backend (NestJS)

Cette documentation détaille les ressources, les rôles et les processus métiers implémentés dans l'API de gestion des bulletins (UML).

## 🚀 Ressources Techniques

- **Framework** : [NestJS](https://nestjs.com/) (v11.0.0+)
- **Langage** : TypeScript
- **ORM** : [Prisma](https://www.prisma.io/)
- **Base de Données** : PostgreSQL (Hébergé sur Render)
- **Authentification** : JWT (JSON Web Tokens) avec Passport.js
- **Génération PDF** : `pdf-lib` pour les bulletins académiques
- **Export Excel** : `exceljs` pour les rapports de notes
- **Déploiement** : [Render](https://render.com/)

## 🔗 Liens Utiles

- **Dépôt GitHub (Backend)** : [https://github.com/sokens1/backend-bulletins-uml.git](https://github.com/sokens1/backend-bulletins-uml.git)
- **API en Production (Render)** : [https://grade-management-api-qfe3.onrender.com](https://grade-management-api-qfe3.onrender.com)
- **Documentation API (Swagger)** : Accessible via `/api/docs` sur l'URL de production.

---

## 👥 Processus par Profil Utilisateur

Le système est architecturé autour de 4 rôles principaux, chacun ayant un flux de travail spécifique.

### 1. Administrateur (ADMIN)
L'administrateur assure l'intégrité et la configuration globale du système.
- **Gestion Académique** : Création et activation des semestres (ex: S5, S6). Configuration des Unités d'Enseignement (UE) et des matières associées.
- **Gestion des Utilisateurs** : Création des comptes pour les enseignants, secrétaires et étudiants. Attribution des rôles.
- **Audit** : Consultation des logs d'audit pour tracer les modifications critiques (notes modifiées, accès, etc.).

### 2. Enseignant (TEACHER)
L'enseignant est responsable de l'évaluation pédagogique.
- **Saisie des Notes** : Interface dédiée pour entrer les notes de Contrôle Continu (CC), d'Examen et de Rattrapage pour les matières qui lui sont assignées.
- **Calcul des Moyennes** : Le système calcule automatiquement les moyennes pondérées en fonction des coefficients et des crédits (ECTS).
- **Assiduité** : Saisie des heures d'absence des étudiants par matière.

### 3. Secrétariat (SECRETARY)
Le secrétariat gère l'aspect administratif et la production des documents officiels.
- **Gestion des Dossiers** : Mise à jour des informations personnelles des étudiants (numéro matricule, date de naissance, provenance).
- **Production de Documents** :
    - Génération des bulletins de notes PDF (individuels ou par classe).
    - Génération du Bulletin Annuel de Synthèse.
- **Exports de Données** : Extraction des listes de notes au format Excel pour les commissions pédagogiques.

### 4. Étudiant (STUDENT)
L'étudiant est le bénéficiaire final des informations.
- **Consultation** : Accès direct à son tableau de bord pour visualiser ses notes et son assiduité en temps réel.
- **Téléchargement** : Possibilité de télécharger ses bulletins officiels au format PDF dès qu'ils sont validés par le secrétariat.

---

## 🛠️ Installation et Exécution en Local

1.  **Cloner le dépôt** : `git clone https://github.com/sokens1/backend-bulletins-uml.git`
2.  **Installer les dépendances** : `npm install`
3.  **Configurer le `.env`** : Remplir la variable `DATABASE_URL` avec votre instance PostgreSQL.
4.  **Synchroniser la base de données** : `npx prisma db push`
5.  **Lancer le serveur** : `npm run start:dev`

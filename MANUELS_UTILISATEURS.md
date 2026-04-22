# Manuels Utilisateurs

Ce document regroupe les guides opérationnels pour :
- Administrateur
- Enseignant
- Secrétariat

Il répond au livrable “Manuels utilisateurs” du cahier des charges.

---

## 1) Guide Administrateur

### 1.1 Objectif du rôle
L’administrateur pilote la plateforme : structure académique, comptes, import/export, supervision des résultats, audit.

### 1.2 Accès principaux
- `Tableau de bord`
- `Saisie des notes`
- `Gestion Absences`
- `Gestion Étudiants`
- `Audit Sécurité`
- `Suivi Promotion`
- `Gestion Académique`
- `Gestion Utilisateurs`
- `Mon Profil`

### 1.3 Tâches courantes

#### A. Créer/mettre à jour la structure académique
1. Ouvrir `Gestion Académique`.
2. Créer les UE par semestre.
3. Ajouter les matières (coefficients, crédits, pondérations CC/Examen).
4. Assigner les enseignants aux matières.
5. Vérifier que les pondérations sont cohérentes (CC + Examen = 1.0).

#### B. Paramétrer les règles de gestion
1. Dans `Gestion Académique`, section “Règles de gestion”.
2. Régler :
   - pénalité d’absence par heure
   - code UE soutenance
   - activation “reprise soutenance”
3. Enregistrer.

#### C. Gérer les étudiants
1. Ouvrir `Gestion Étudiants`.
2. Ajouter manuellement ou importer via Excel.
3. Vérifier les champs obligatoires : matricule, nom, prénom, email, date/lieu de naissance, classe.
4. Télécharger les bulletins individuels si nécessaire.

#### D. Gérer les utilisateurs staff
1. Ouvrir `Gestion Utilisateurs`.
2. Créer enseignant ou secrétariat.
3. Supprimer/mettre à jour un compte staff en cas de besoin.

#### E. Contrôler les résultats
1. Ouvrir `Suivi Promotion`.
2. Choisir le semestre.
3. Analyser les moyennes/rangs.
4. Exporter les résultats (XLSX).
5. Télécharger les bulletins individuels.
6. Télécharger tous les bulletins du semestre (ZIP) si nécessaire.

#### F. Audit
1. Ouvrir `Audit Sécurité`.
2. Vérifier l’historique des opérations sensibles.

### 1.4 Bonnes pratiques
- Toujours vérifier le semestre sélectionné avant import/export.
- En cas d’import de notes, privilégier le canevas fourni.
- Conserver une sauvegarde du fichier source Excel avant import.

---

## 2) Guide Enseignant

### 2.1 Objectif du rôle
L’enseignant saisit les notes de ses matières et suit les résultats de ses étudiants.

### 2.2 Accès principaux
- `Tableau de bord`
- `Saisie des notes`
- `Mon Profil`

### 2.3 Saisie des notes (session normale)
1. Ouvrir `Saisie des notes`.
2. Choisir l’étudiant.
3. Choisir la matière.
4. Laisser le mode sur `Normal`.
5. Renseigner `Note CC` et `Note Examen`.
6. Enregistrer.

### 2.4 Saisie des notes (rattrapage)
1. Ouvrir `Saisie des notes`.
2. Choisir l’étudiant et la matière.
3. Basculer le switch sur `Rattrapage`.
4. Renseigner `Note de rattrapage`.
5. Enregistrer.

Comportement :
- CC/Examen sont verrouillées en mode rattrapage.
- La note de rattrapage remplace la moyenne matière pour tous les calculs.

### 2.5 Import des notes via Excel
1. Télécharger le `Canevas notes`.
2. Remplir les lignes (matricule étudiant, matière, notes).
3. Sélectionner le semestre dans l’interface.
4. Importer le fichier.
5. Vérifier le message `imported/skipped`.

### 2.6 Export des notes via Excel
1. Sélectionner le semestre.
2. Cliquer `Exporter notes`.
3. Un fichier XLSX est téléchargé avec toutes les notes du semestre.

### 2.7 Bonnes pratiques
- Utiliser les identifiants exacts (matricule, libellé matière ou ID selon canevas).
- Contrôler les lignes ignorées après import.
- Utiliser rattrapage uniquement pour la session de rattrapage.

---

## 3) Guide Secrétariat

### 3.1 Objectif du rôle
Le secrétariat saisit les notes, gère les absences, édite les bulletins et participe au suivi opérationnel.

### 3.2 Accès principaux
- `Tableau de bord`
- `Saisie des notes`
- `Gestion Absences`
- `Suivi Promotion` (édition / téléchargement des bulletins)
- `Mon Profil`

### 3.3 Gestion des absences
1. Ouvrir `Gestion Absences`.
2. Ajouter/modifier les heures d’absence.
3. Vérifier les enregistrements.

Effet métier :
- la pénalité (paramétrée par l’administrateur) est appliquée aux moyennes matière.

### 3.4 Edition des bulletins
1. Ouvrir `Suivi Promotion`.
2. Choisir le semestre.
3. Rechercher l’étudiant.
4. Télécharger le bulletin PDF.
5. Exporter les résultats en XLSX si besoin.
6. Télécharger tous les bulletins du semestre en ZIP si besoin.

### 3.5 Import étudiants / notes
- Étudiants : via `Gestion Étudiants` (si le compte secrétariat dispose de l’accès).
- Notes : via `Saisie des notes`, import Excel avec semestre sélectionné.

### 3.6 Connexion des étudiants importés
Après import Excel des étudiants :
- identifiant : email importé
- mot de passe : valeur `MOT_DE_PASSE_INITIAL` du fichier, sinon mot de passe par défaut `Inptic2024!`

---

## 4) Rappels de règles de calcul (résumé)

- Moyenne matière :
  - Normal : CC 40% + Examen 60%
  - Une seule note disponible : note retenue telle quelle
  - Rattrapage : remplace la moyenne matière
  - Pénalité absence : retrait selon paramètre `pénalité/heure`
- Moyenne UE : moyenne pondérée par coefficients matière
- Moyenne semestre : moyenne pondérée des UE
- Validation UE : direct (>=10) ou compensation si moyenne semestre >=10
- Validation semestre : crédits acquis >= crédits du semestre
- Décision annuelle : diplômé / reprise soutenance / redoublement selon règles configurées
- Mention annuelle : Passable, Assez Bien, Bien, Très Bien selon moyenne annuelle

---

## 5) Procédure rapide de dépannage

1. Vérifier token/session (`Mon Profil` accessible).
2. Vérifier le semestre sélectionné.
3. Vérifier format des données importées (canevas officiel).
4. Recharger la page après une grosse importation.
5. Consulter l’audit (admin) pour tracer les opérations.


# Manuel Utilisateur - Système de Gestion des Bulletins (INPTIC)

Ce guide est conçu pour vous aider à prendre en main la plateforme de gestion académique. Il détaille les fonctionnalités par rôle et les processus critiques.

---

## 1. Introduction
Le système permet la gestion complète du cycle de vie des notes, de la structuration des enseignements jusqu'à l'édition des bulletins de notes (semestriels et annuels) et des relevés de promotion.

---

## 2. Guide Administrateur (Pilote)

### 2.1 Configuration Académique & Clôture
L'administrateur définit la structure des cours et contrôle les périodes de saisie.

1. **Gestion de la structure** : Allez dans `Gestion Académique` pour créer les Unités d'Enseignement (UE) et les Matières (coefficients, crédits, pondérations).
   - **[CAPTURE : Page de Gestion Académique montrant la liste des UEs et Matières]**
2. **Verrouillage du Semestre (Clôture)** : 
   - Un bouton **Verrouiller/Déverrouiller** (icône cadenas) est disponible pour chaque semestre.
   - Lorsqu'un semestre est **Verrouillé**, les professeurs et le secrétariat ne peuvent plus modifier les notes ni les absences.
   - Le téléchargement des bulletins par les étudiants est également bloqué automatiquement.
   - **[CAPTURE : Bouton de verrouillage/déverrouillage dans la configuration académique]**
3. **Paramétrage des pénalités** : Dans l'onglet "Règles de gestion", réglez la valeur de la pénalité par heure d'absence.
   - **[CAPTURE : Formulaire des règles de gestion et pénalités]**

### 2.2 Gestion des Étudiants & Staff
1. **Étudiants** : Utilisez `Gestion Étudiants` pour ajouter des élèves ou les importer par lot via Excel (Canevas Students).
   - **[CAPTURE : Interface de gestion des étudiants avec bouton d'importation]**
2. **Staff** : Créez des comptes pour les enseignants et le secrétariat dans `Gestion Utilisateurs`.
   - **[CAPTURE : Liste des utilisateurs staff et bouton de création]**

### 2.3 Suivi de Promotion & Exports Avancés (XLSX)
1. Allez dans `Suivi Promotion`.
2. **Export XLSX Détaillé** : Le bouton **XLSX** génère désormais un **relevé de notes total**.
   - Le fichier inclut toutes les notes CC, Exam, Moyennes et Absences de chaque matière pour toute la classe.
   - **[CAPTURE : Page Suivi Promotion avec les boutons d'export XLSX et ZIP]**
3. **Export Annuel** : En mode "Annuel", vous pouvez exporter la promotion complète avec les moyennes S5, S6 et la décision finale du jury.

---

## 3. Guide Enseignant (Saisie & Suivi)

### 3.1 Saisie des Notes
1. Allez dans `Saisie des Notes`.
2. Sélectionnez l'étudiant et la matière.
3. Saisissez les notes (CC, Examen ou Rattrapage).
   - **[CAPTURE : Formulaire de saisie des notes avec le sélecteur Normal/Rattrapage]**
4. **Important** : Si le semestre est verrouillé, le bouton d'enregistrement sera grisé avec la mention "Semestre Verrouillé".

### 3.2 Importation de Notes par Excel
1. Téléchargez le canevas via le bouton `Template Grades`.
2. Remplissez le fichier et importez-le en vous assurant que le bon semestre est sélectionné.
   - **[CAPTURE : Fenêtre d'importation Excel pour les notes]**

---

## 4. Guide Secrétariat (Opérationnel)

### 4.1 Gestion des Absences & Pénalités
Le secrétariat enregistre les absences qui impactent automatiquement la moyenne des matières.
1. Allez dans `Gestion Absences`.
2. Saisissez les heures d'absence pour l'étudiant et la matière concernée.
   - **[CAPTURE : Interface de gestion des absences et formulaire d'ajout]**
3. **Effet Automatique** : La pénalité est déduite de la moyenne de la matière sur le bulletin.

### 4.2 Édition des Bulletins & ZIP
1. Dans `Suivi Promotion`, recherchez un étudiant.
2. Cliquez sur l'icône **PDF** pour générer le bulletin officiel.
   - **[CAPTURE : Rendu du bulletin PDF montrant la colonne "Hrs Abs." et les pénalités]**
3. **Export ZIP** : Téléchargez tous les bulletins d'un semestre en un clic pour l'archivage.

---

## 5. Rappels de Règles & Dépannage

### 📏 Règles de Calcul
- **Moyenne Matière** : `(Note_CC * Poids_CC) + (Note_Exam * Poids_Exam) - (Heures_Absence * Pénalité)`.
- **Validation UE** : 
   - Directe si Moyenne UE >= 10/20.
   - Par compensation si Moyenne Semestre >= 10/20.
- **Rattrapage** : La note de rattrapage remplace intégralement la moyenne de la matière (CC et Exam ignorés).

### 🆘 Procédure de Dépannage
1. **Accès bloqué** : Vérifiez que l'admin n'a pas verrouillé le semestre.
2. **Notes manquantes après import** : Consultez la liste des lignes "Skipped" après l'import Excel pour voir les erreurs (matricule erroné, etc.).
3. **Bulletin non disponible** : Vérifiez que l'étudiant a bien des notes saisies pour ce semestre.

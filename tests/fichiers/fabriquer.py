#!/usr/bin/env python3
"""Fabrique des listes de joueurs FICTIVES pour tester l'import (n° 47). Aucune donnée réelle."""
import datetime, os, openpyxl
D = os.path.dirname(os.path.abspath(__file__))
J = [("DURAND", "Léo", datetime.date(2016, 3, 12), "parent.leo@exemple.fr", 612345678, "Évry"),
     ("LE BRAS", "Anna", datetime.date(2016, 8, 16), "anna.p@exemple.fr", 698765432, "Ris"),
     ("DA SILVA COSTA", "Bruno", datetime.date(2017, 1, 3), "", "", "Lardy"),
     ("MARTIN", "Zoé", datetime.date(2016, 11, 30), "zoe.m@exemple.fr", "06 11 22 33 44", "Boissy")]

def save(wb, n): wb.save(os.path.join(D, n))

# 1. « Nom, prénom » combiné, en-tête en ligne 1, vraies dates Excel, téléphone en nombre (zéro perdu)
wb = openpyxl.Workbook(); ws = wb.active
ws.append(["Nom, prénom", "Date de naissance", "Mail", "Numéro de téléphone", "Ville"])
for n, p, d, m, t, v in J: ws.append([f"{n} {p}", d, m, t, v])
save(wb, "combine.xlsx")
# 2. titre et lignes vides au-dessus, cellules fusionnées, colonnes séparées
wb = openpyxl.Workbook(); ws = wb.active
ws["A1"] = "Club fictif · liste U11 · saison 2026-2027"; ws.merge_cells("A1:E1"); ws.append([]); ws.append([])
ws.append(["Nom", "Prénom", "Né(e) le", "N° licence", "Tél. parent"])
for i, (n, p, d, m, t, v) in enumerate(J): ws.append([n, p, d.strftime("%d/%m/%Y"), f"VT{1000000 + i}", t])
save(wb, "entete_bas.xlsx")
# 3. première feuille vide, données dans la seconde
wb = openpyxl.Workbook(); wb.active.title = "Accueil"; ws = wb.create_sheet("Joueurs")
ws.append(["Prénom", "Nom", "Date de naissance"])
for n, p, d, m, t, v in J: ws.append([p, n, d])
save(wb, "feuille_vide.xlsx")
# 4. sans en-tête : NOM ; Prénom ; date ; ville
wb = openpyxl.Workbook(); ws = wb.active
for n, p, d, m, t, v in J: ws.append([n, p, d, v])
save(wb, "sans_entete.xlsx")
# 5. CSV Excel français (point-virgule, encodage Windows-1252) et CSV UTF-8 avec BOM
rows = ["Nom;Prénom;Date de naissance;Ville"] + [f"{n};{p};{d.strftime('%d/%m/%Y')};{v}" for n, p, d, m, t, v in J]
open(os.path.join(D, "excel_windows.csv"), "wb").write(("\r\n".join(rows) + "\r\n").encode("cp1252"))
open(os.path.join(D, "utf8_bom.csv"), "wb").write(("﻿" + "\r\n".join(rows) + "\r\n").encode("utf-8"))
print("fichiers fictifs écrits dans", D)

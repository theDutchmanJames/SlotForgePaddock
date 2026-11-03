'use strict';
// Rebuildable counters, updated by SQLite in the same transaction as the
// search rows, including foreign-key cascades. Never an authority for stock.
const columns=['n','quantity','owned','reserved','incoming','fitted'];
function contribution(row,sign){
 const quantity=`coalesce(json_extract(${row}.aux,'$.quantity'),0)`;
 const expressions=['1',quantity,`CASE WHEN ${quantity}>0 THEN 1 ELSE 0 END`,`coalesce(json_extract(${row}.aux,'$.reserved'),0)`,`coalesce(json_extract(${row}.aux,'$.incoming'),0)`,`CASE WHEN ${row}.bucket='["installations"]' AND json_extract(${row}.aux,'$.removed')=0 THEN ${quantity} ELSE 0 END`];
 return `INSERT INTO query_totals(bucket,status,archived,${columns.join(',')}) VALUES(${row}.bucket,${row}.status,${row}.archived,${expressions.map(e=>`(${e})*${sign}`).join(',')}) ON CONFLICT(bucket,status,archived) DO UPDATE SET ${columns.map(c=>`${c}=${c}+excluded.${c}`).join(',')}; DELETE FROM query_totals WHERE n=0;`;
}
function schema(db){
 db.exec(`DROP TRIGGER IF EXISTS query_totals_insert; DROP TRIGGER IF EXISTS query_totals_update; DROP TRIGGER IF EXISTS query_totals_delete; DROP TABLE IF EXISTS query_totals;
 CREATE TABLE query_totals(bucket TEXT NOT NULL,status TEXT NOT NULL,archived INTEGER NOT NULL,n INTEGER NOT NULL,quantity REAL NOT NULL,owned INTEGER NOT NULL,reserved REAL NOT NULL,incoming REAL NOT NULL,fitted REAL NOT NULL,PRIMARY KEY(bucket,status,archived)) STRICT;
 CREATE TRIGGER query_totals_insert AFTER INSERT ON query_records BEGIN ${contribution('NEW',1)} END;
 CREATE TRIGGER query_totals_update AFTER UPDATE ON query_records BEGIN ${contribution('OLD',-1)} ${contribution('NEW',1)} END;
 CREATE TRIGGER query_totals_delete AFTER DELETE ON query_records BEGIN ${contribution('OLD',-1)} END;`);
}
function rebuild(db){
 schema(db);
 db.exec(`INSERT INTO query_totals SELECT bucket,status,archived,count(*),sum(coalesce(json_extract(aux,'$.quantity'),0)),sum(CASE WHEN json_extract(aux,'$.quantity')>0 THEN 1 ELSE 0 END),sum(coalesce(json_extract(aux,'$.reserved'),0)),sum(coalesce(json_extract(aux,'$.incoming'),0)),sum(CASE WHEN bucket='["installations"]' AND json_extract(aux,'$.removed')=0 THEN coalesce(json_extract(aux,'$.quantity'),0) ELSE 0 END) FROM query_records GROUP BY bucket,status,archived`);
}
module.exports={schema,rebuild};

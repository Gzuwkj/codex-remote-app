"""Read-only desktop catalog. Never resume or write sessions in a second runtime."""
import json,sqlite3,sys,pathlib
db=pathlib.Path(sys.argv[1])/'state_5.sqlite'
con=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
con.row_factory=sqlite3.Row
rows=con.execute('select id,title,cwd,updated_at from threads where archived=0 order by updated_at desc limit 100').fetchall()
print(json.dumps([dict(r) for r in rows],ensure_ascii=True))
